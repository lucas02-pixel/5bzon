// ─── Firebase ───

import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";

import {
  getFirestore,
  collection,
  getDocs,
  doc,
  runTransaction,
  addDoc,
  serverTimestamp
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";

import { getMessaging, getToken, onMessage } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyCXFhRZ_Byp40-sIxaNkyICoe066p6J04w",
  authDomain: "banco-sulegal-e93c5.firebaseapp.com",
  projectId: "banco-sulegal-e93c5",
  storageBucket: "banco-sulegal-e93c5.firebasestorage.app",
  messagingSenderId: "917084456664",
  appId: "1:917084456664:web:0fa0ecae429aded7cbb9ad"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);
const messaging = getMessaging(app);

const GIX_LOJA = "SUL873302";
const MAX_QTY  = 5;

// ─── State ───
let products      = [];
let cart          = {};
let loggedUser    = null;
let coupons       = [];
let appliedCoupon = null;

// ─── Helpers Firebase ───
async function findByGix(gix) {
  const snap = await getDocs(collection(db, "Contas"));
  for (const d of snap.docs) {
    const data = d.data();
    if (data.gix && data.gix.toUpperCase() === gix.toUpperCase()) {
      return { id: d.id, data };
    }
  }
  return null;
}

// ─── Firebase Messaging Setup ───
async function setupNotifications() {
  try {
    const permission = await Notification.requestPermission();
    if (permission === 'granted') {
      const swUrl = './firebase-messaging-sw.js';
      const registration = await navigator.serviceWorker.register(swUrl, { scope: './' });

      const token = await getToken(messaging, {
        vapidKey: 'BL--aAa65MV3IJvW0r7ZTENZhgVh1VqOdvmrh8XkmkMBf8m0pQNmA2bzPxo9q5N8tnlDAHiWDZ0ZPCBIs5E7ytE',
        serviceWorkerRegistration: registration
      });

      if (token) {
        console.log('Token FCM gerado com sucesso:', token);
      }
    }
  } catch (error) {
    console.error('Erro ao configurar o Firebase Messaging:', error);
  }
}

// ─── Intro ───
function runIntro() {
  setTimeout(() => {
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('site').classList.add('visible');
  }, 2000);
}

// ─── Notificação de boas-vindas ───
function requestWelcomeNotification() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      new Notification("Nova mensagem!", {
        body: "Bem-vindo ao 5bzon."
      });
    }
  });
}

// ─── Load products ───
async function loadProducts() {
  const res = await fetch('https://raw.githubusercontent.com/lucas02-pixel/5bzon/refs/heads/main/Products.json');
  products  = await res.json();
  renderProducts();
}

// ─── Load coupons ───
async function loadCoupons() {
  try {
    const res = await fetch('https://raw.githubusercontent.com/lucas02-pixel/5bzon/refs/heads/main/coupons.json');
    coupons = await res.json();
  } catch (e) {
    console.warn('Cupons não carregados:', e);
    coupons = [];
  }
}

// ─── Render products ───
function renderProducts() {
  const grid = document.getElementById('products-grid');
  grid.innerHTML = '';
  products.forEach(p => {
    const qty   = cart[p.id] || 0;
    const maxed = qty >= MAX_QTY;
    const card  = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-desc">${p.desc}</div>
      <div class="product-footer">
        <div class="product-price">${p.price} <span>sulegais</span></div>
        <button class="add-btn ${maxed ? 'maxed' : ''}" data-id="${p.id}" ${maxed ? 'disabled' : ''}>
          ${maxed ? '✓ Máx' : '+ Adicionar'}
        </button>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.add-btn').forEach(btn =>
    btn.addEventListener('click', () => addToCart(parseInt(btn.dataset.id)))
  );
}

// ─── Cart ───
function addToCart(id) {
  const qty = cart[id] || 0;
  if (qty >= MAX_QTY) return;
  cart[id] = qty + 1;
  updateUI();
}

// ─── Change Qty ───
function changeQty(id, delta) {
  const qty = (cart[id] || 0) + delta;
  if (qty <= 0) delete cart[id];
  else cart[id] = Math.min(qty, MAX_QTY);
  updateUI();
}

// ─── Cart Total (bruto, sem cupom) ───
function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find(x => x.id === parseInt(id));
    return sum + (p ? p.price * qty : 0);
  }, 0);
}

// ─── Total com desconto aplicado ───
function cartTotalWithDiscount() {
  const raw = cartTotal();
  if (!appliedCoupon) return raw;

  let total;
  if (appliedCoupon.type === 'percent') {
    const desconto = Math.ceil(raw * appliedCoupon.value / 100);
    total = raw - desconto;
  } else if (appliedCoupon.type === 'fixed') {
    total = raw - appliedCoupon.value;
  } else {
    total = raw;
  }
  return Math.max(0, total);
}

// ─── Update UI ───
function updateUI() {
  renderProducts();
  renderCart();
  updateCartCount();
}

// ─── Update Cart Count ───
function updateCartCount() {
  const total = Object.values(cart).reduce((a, b) => a + b, 0);
  document.getElementById('cart-count').textContent = total;
}

// ─── Render Cart ───
function renderCart() {
  const container   = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');
  const entries     = Object.entries(cart).filter(([, q]) => q > 0);

  if (entries.length === 0) {
    container.innerHTML = '<div class="cart-empty">🛒<br/>Carrinho vazio.<br/>Adicione uns quadrinhos aí!</div>';
    // Desabilita o botão quando carrinho está vazio
    if (checkoutBtn) checkoutBtn.disabled = true;
  } else {
    container.innerHTML = '';
    entries.forEach(([id, qty]) => {
      const p = products.find(x => x.id === parseInt(id));
      if (!p) return;
      const item = document.createElement('div');
      item.className = 'cart-item';
      item.innerHTML = `
        <div class="ci-emoji">${p.emoji}</div>
        <div class="ci-info">
          <div class="ci-name">${p.name}</div>
          <div class="ci-price">${p.price * qty} sulegais (${qty}x)</div>
        </div>
        <div class="ci-controls">
          <button class="ci-btn" data-id="${p.id}" data-delta="-1">−</button>
          <div class="ci-qty">${qty}</div>
          <button class="ci-btn" data-id="${p.id}" data-delta="1" ${qty >= MAX_QTY ? 'disabled style="opacity:.3"' : ''}>+</button>
        </div>`;
      container.appendChild(item);
    });
    container.querySelectorAll('.ci-btn').forEach(btn =>
      btn.addEventListener('click', () =>
        changeQty(parseInt(btn.dataset.id), parseInt(btn.dataset.delta))
      )
    );
    // Habilita o botão quando há itens
    if (checkoutBtn) checkoutBtn.disabled = false;
  }

  document.getElementById('cart-total').textContent = cartTotalWithDiscount();
}

// ─── Drawer ───
function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ─── Payment screen steps ───
function payShowStep(id) {
  ['pay-step-login', 'pay-step-coupon', 'pay-step-paying', 'pay-step-success', 'pay-step-error']
    .forEach(s => {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

// ─── Show Payment ───
function showPayment() {
  // Só abre se o carrinho tiver itens
  if (cartTotal() === 0) return;

  closeCart();
  appliedCoupon = null;

  document.getElementById('pay-gix-input').value   = '';
  document.getElementById('pay-senha-input').value = '';
  document.getElementById('pay-login-error').style.display = 'none';
  document.getElementById('pay-login-error').textContent   = '';

  document.getElementById('pay-valor').textContent = cartTotal();
  payShowStep('pay-step-login');
  document.getElementById('payment-screen').classList.add('visible');
}

// ─── Hide Payment ───
function hidePayment() {
  document.getElementById('payment-screen').classList.remove('visible');
}

// ─── Login no pagamento ───
async function doPayLogin() {
  const gix   = document.getElementById('pay-gix-input').value.trim().toUpperCase();
  const senha = document.getElementById('pay-senha-input').value.trim();
  const errEl = document.getElementById('pay-login-error');
  const btn   = document.getElementById('pay-login-btn');

  errEl.style.display = 'none';

  if (!gix)   { errEl.textContent = 'Informe seu GIX';   errEl.style.display = 'block'; return; }
  if (!senha) { errEl.textContent = 'Informe sua senha'; errEl.style.display = 'block'; return; }

  btn.disabled    = true;
  btn.textContent = 'Verificando...';

  try {
    const result = await findByGix(gix);

    if (!result)                             { errEl.textContent = 'Conta não encontrada';     errEl.style.display = 'block'; return; }
    if (result.data.senha !== senha)         { errEl.textContent = 'Senha incorreta';          errEl.style.display = 'block'; return; }
    if (gix === GIX_LOJA.toUpperCase())      { errEl.textContent = 'Use uma conta de cliente'; errEl.style.display = 'block'; return; }

    loggedUser = { docId: result.id, gix, nome: result.data.nome || result.id, saldo: result.data.saldo };

    renderCouponStep();
    payShowStep('pay-step-coupon');

  } catch (e) {
    console.error(e);
    errEl.textContent   = 'Erro de conexão. Tente novamente.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Entrar →';
  }
}

// ─── Renderiza a etapa de cupom ───
function renderCouponStep() {
  document.getElementById('pay-coupon-input').value = '';
  document.getElementById('pay-coupon-feedback').style.display = 'none';
  document.getElementById('pay-coupon-feedback').className = 'pay-coupon-feedback';
  appliedCoupon = null;
  updateCouponSummary();
}

// ─── Aplica o cupom ───
function doApplyCoupon() {
  const code = document.getElementById('pay-coupon-input').value.trim().toUpperCase();
  const fbEl = document.getElementById('pay-coupon-feedback');

  if (!code) {
    fbEl.textContent   = 'Digite um código de cupom';
    fbEl.className     = 'pay-coupon-feedback error';
    fbEl.style.display = 'block';
    return;
  }

  const found = coupons.find(c => c.code.toUpperCase() === code);
  if (!found) {
    appliedCoupon      = null;
    fbEl.textContent   = '❌ Cupom inválido';
    fbEl.className     = 'pay-coupon-feedback error';
    fbEl.style.display = 'block';
    updateCouponSummary();
    return;
  }

  appliedCoupon      = found;
  fbEl.textContent   = `✅ ${found.desc}`;
  fbEl.className     = 'pay-coupon-feedback success';
  fbEl.style.display = 'block';
  updateCouponSummary();
}

// ─── Remove cupom ───
function doRemoveCoupon() {
  appliedCoupon = null;
  document.getElementById('pay-coupon-input').value = '';
  document.getElementById('pay-coupon-feedback').style.display = 'none';
  updateCouponSummary();
}

// ─── Atualiza resumo de preço na etapa de cupom ───
function updateCouponSummary() {
  const raw      = cartTotal();
  const total    = cartTotalWithDiscount();
  const discount = raw - total;

  document.getElementById('pay-coupon-original').textContent = raw + ' sulegais';
  document.getElementById('pay-coupon-final').textContent    = total + ' sulegais';

  const discountEl = document.getElementById('pay-coupon-discount-row');
  const summaryEl  = document.getElementById('pay-coupon-summary');

  if (appliedCoupon && discount > 0) {
    discountEl.style.display = 'flex';
    document.getElementById('pay-coupon-discount-val').textContent = '−' + discount + ' sulegais';
    summaryEl.classList.add('has-discount');
  } else {
    discountEl.style.display = 'none';
    summaryEl.classList.remove('has-discount');
  }

  document.getElementById('pay-remove-coupon-btn').style.display = appliedCoupon ? 'block' : 'none';
}

// ─── Avança do cupom para confirmação ───
function doContinueFromCoupon() {
  const raw      = cartTotal();
  const total    = cartTotalWithDiscount();
  const discount = raw - total;

  document.getElementById('pay-user-name').textContent  = loggedUser.nome;
  document.getElementById('pay-user-gix').textContent   = 'GIX: ' + loggedUser.gix;
  document.getElementById('pay-user-saldo').textContent = loggedUser.saldo + ' sulegais';
  document.getElementById('pay-valor2').textContent     = total;

  const confDiscRow = document.getElementById('pay-conf-discount-row');
  const confOrigRow = document.getElementById('pay-conf-original-row');

  if (appliedCoupon && discount > 0) {
    confOrigRow.style.display = 'flex';
    confDiscRow.style.display = 'flex';
    document.getElementById('pay-conf-original-val').textContent = raw + ' sulegais';
    document.getElementById('pay-conf-discount-val').textContent = '−' + discount + ' sulegais (' + appliedCoupon.code + ')';
  } else {
    confOrigRow.style.display = 'none';
    confDiscRow.style.display = 'none';
  }

  const semSaldo = loggedUser.saldo < total;
  document.getElementById('pay-saldo-warn').style.display   = semSaldo ? 'block' : 'none';
  document.getElementById('pay-confirm-btn').disabled        = semSaldo;
  document.getElementById('pay-paying-error').style.display = 'none';

  payShowStep('pay-step-paying');
}

// ─── Confirmar pagamento ───
async function doConfirmPayment() {
  const total = cartTotalWithDiscount();
  const btn   = document.getElementById('pay-confirm-btn');
  const errEl = document.getElementById('pay-paying-error');

  errEl.style.display = 'none';
  btn.disabled        = true;
  btn.textContent     = 'Processando...';

  try {
    const lojaResult = await findByGix(GIX_LOJA);
    if (!lojaResult) throw new Error('Conta da loja não encontrada');

    const userRef = doc(db, "Contas", loggedUser.docId);
    const lojaRef = doc(db, "Contas", lojaResult.id);

    await runTransaction(db, async (t) => {
      const userSnap = await t.get(userRef);
      const lojaSnap = await t.get(lojaRef);

      if (!userSnap.exists() || !lojaSnap.exists()) throw new Error('Conta não encontrada');

      const saldoUser = userSnap.data().saldo;
      if (saldoUser < total) throw new Error('Saldo insuficiente');

      t.update(userRef, { saldo: saldoUser - total });
      t.update(lojaRef, { saldo: lojaSnap.data().saldo + total });
    });

    const itensList = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => {
        const p = products.find(x => x.id === parseInt(id));
        return p ? `${p.name} (x${qty})` : '';
      })
      .filter(Boolean);

    await addDoc(collection(db, "avisos"), {
      gix:       loggedUser.gix,
      nome:      loggedUser.nome,
      itens:     itensList,
      total:     total,
      cupom:     appliedCoupon ? appliedCoupon.code : null,
      timestamp: serverTimestamp()
    });

    document.getElementById('pay-success-valor').textContent = total;
    document.getElementById('pay-success-nome').textContent  = loggedUser.nome;
    payShowStep('pay-step-success');

    cart = {};
    appliedCoupon = null;
    updateUI();

  } catch (e) {
    console.error(e);
    const msg = e.message === 'Saldo insuficiente'
      ? 'Saldo insuficiente para esta compra.'
      : 'Falha na transação. Tente novamente.';
    errEl.textContent   = msg;
    errEl.style.display = 'block';
    btn.disabled        = false;
    btn.textContent     = 'Confirmar pagamento';
  }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  runIntro();
  loadProducts();
  loadCoupons();
  requestWelcomeNotification();
  setupNotifications();

  document.getElementById('cart-btn').addEventListener('click', openCart);
  document.getElementById('overlay').addEventListener('click', closeCart);
  document.getElementById('close-drawer').addEventListener('click', closeCart);

  // ── Botão Finalizar Compra ──
  const checkoutBtn = document.getElementById('checkout-btn');
  checkoutBtn.disabled = true; // começa desabilitado até ter itens
  checkoutBtn.addEventListener('click', () => {
    if (cartTotal() > 0) {
      showPayment();
    }
  });

  // Step login
  document.getElementById('pay-login-btn').addEventListener('click', doPayLogin);
  document.getElementById('pay-back-login').addEventListener('click', hidePayment);

  // Step cupom
  document.getElementById('pay-apply-coupon-btn').addEventListener('click', doApplyCoupon);
  document.getElementById('pay-remove-coupon-btn').addEventListener('click', doRemoveCoupon);
  document.getElementById('pay-skip-coupon-btn').addEventListener('click', doContinueFromCoupon);
  document.getElementById('pay-coupon-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doApplyCoupon();
  });

  // Step confirmar
  document.getElementById('pay-confirm-btn').addEventListener('click', doConfirmPayment);
  document.getElementById('pay-change-user').addEventListener('click', () => payShowStep('pay-step-login'));
  document.getElementById('pay-back-coupon').addEventListener('click', () => payShowStep('pay-step-coupon'));

  // Step sucesso / erro
  document.getElementById('pay-new-btn').addEventListener('click', () => { hidePayment(); loggedUser = null; });
  document.getElementById('pay-error-retry').addEventListener('click', hidePayment);

  // Enter no login
  document.getElementById('pay-gix-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pay-senha-input').focus();
  });
  document.getElementById('pay-senha-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doPayLogin();
  });

  updateCartCount();
  renderCart();
});

// ─── Nav tabs ───
const homeTab = document.getElementById("home-tab");
const cartTab = document.getElementById("cart-tab");

homeTab.addEventListener("click", () => {
  homeTab.classList.add("active");
  cartTab.classList.remove("active");
  closeCart();
  window.scrollTo({ top: 0, behavior: "smooth" });
});

cartTab.addEventListener("click", () => {
  cartTab.classList.add("active");
  homeTab.classList.remove("active");
  openCart();
});

document.getElementById("overlay").addEventListener("click", () => {
  homeTab.classList.add("active");
  cartTab.classList.remove("active");
});
