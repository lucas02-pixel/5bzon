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

const GIX_LOJA    = "SUL873302";
const MAX_QTY     = 5;

// ─── State ───
let products   = [];
let cart       = {};
let loggedUser = null; // { docId, gix, nome, saldo }

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

// ─── Intro ───
function runIntro() {
  setTimeout(() => {
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('site').classList.add('visible');
  }, 2000);
}

// ─── Load products ───
async function loadProducts() {
  // Alterado apenas aqui para buscar do link do GitHub Raw que você enviou
  const res = await fetch('https://raw.githubusercontent.com/lucas02-pixel/5bzon/refs/heads/main/Products.json');
  products  = await res.json();
  renderProducts();
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

// ─── Cart Total ───
function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find(x => x.id === parseInt(id));
    return sum + (p ? p.price * qty : 0);
  }, 0);
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
  const container = document.getElementById('cart-items');
  const entries   = Object.entries(cart).filter(([, q]) => q > 0);

  if (entries.length === 0) {
    container.innerHTML = '<div class="cart-empty">🛒<br/>Carrinho vazio.<br/>Adicione uns quadrinhos aí!</div>';
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
  }

  document.getElementById('cart-total').textContent = cartTotal();
  document.getElementById('checkout-btn').disabled = cartTotal() === 0;
}

// ─── Drawer ───
function openCart()  {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// ─── Payment screen steps ───
function payShowStep(id) {
  ['pay-step-login', 'pay-step-paying', 'pay-step-success', 'pay-step-error']
    .forEach(s => {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

// ─── Show Payment ───
function showPayment() {
  closeCart();
  const total = cartTotal();
  document.getElementById('pay-valor').textContent = total;

  // Resetar login fields
  document.getElementById('pay-gix-input').value   = '';
  document.getElementById('pay-senha-input').value = '';
  document.getElementById('pay-login-error').style.display = 'none';
  document.getElementById('pay-login-error').textContent   = '';

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

  if (!gix)   { errEl.textContent = 'Informe seu GIX';  errEl.style.display = 'block'; return; }
  if (!senha) { errEl.textContent = 'Informe sua senha'; errEl.style.display = 'block'; return; }

  btn.disabled    = true;
  btn.textContent = 'Verificando...';

  try {
    const result = await findByGix(gix);

    if (!result)                       { errEl.textContent = 'Conta não encontrada';  errEl.style.display = 'block'; return; }
    if (result.data.senha !== senha)   { errEl.textContent = 'Senha incorreta';       errEl.style.display = 'block'; return; }
    if (gix === GIX_LOJA.toUpperCase()){ errEl.textContent = 'Use uma conta de cliente'; errEl.style.display = 'block'; return; }

    loggedUser = { docId: result.id, gix, nome: result.id, saldo: result.data.saldo };

    // Mostrar resumo antes de pagar
    const total = cartTotal();
    document.getElementById('pay-user-name').textContent   = loggedUser.nome;
    document.getElementById('pay-user-gix').textContent    = 'GIX: ' + gix;
    document.getElementById('pay-user-saldo').textContent  = result.data.saldo + ' sulegais';
    document.getElementById('pay-valor2').textContent      = total;

    const semSaldo = result.data.saldo < total;
    document.getElementById('pay-saldo-warn').style.display = semSaldo ? 'block' : 'none';
    document.getElementById('pay-confirm-btn').disabled     = semSaldo;

    payShowStep('pay-step-paying');
  } catch (e) {
    console.error(e);
    errEl.textContent    = 'Erro de conexão. Tente novamente.';
    errEl.style.display  = 'block';
  } finally {
    btn.disabled    = false;
    btn.textContent = 'Entrar →';
  }
}

// ─── Confirmar pagamento ───
async function doConfirmPayment() {
  const total  = cartTotal();
  const btn    = document.getElementById('pay-confirm-btn');
  const errEl  = document.getElementById('pay-paying-error');

  errEl.style.display  = 'none';
  btn.disabled         = true;
  btn.textContent      = 'Processando...';

  try {
    // Buscar conta da loja
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

    // Montar lista de itens comprados
    const itensList = Object.entries(cart)
      .filter(([, q]) => q > 0)
      .map(([id, qty]) => {
        const p = products.find(x => x.id === parseInt(id));
        return p ? `${p.name} (x${qty})` : '';
      })
      .filter(Boolean);

    // Registrar em avisos
    await addDoc(collection(db, "avisos"), {
      gix:       loggedUser.gix,
      nome:      loggedUser.nome,
      itens:     itensList,
      total:     total,
      timestamp: serverTimestamp()
    });

    // Sucesso
    document.getElementById('pay-success-valor').textContent = total;
    document.getElementById('pay-success-nome').textContent  = loggedUser.nome;
    payShowStep('pay-step-success');

    // Limpar carrinho
    cart = {};
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

  document.getElementById('cart-btn').addEventListener('click', openCart);
  document.getElementById('overlay').addEventListener('click', closeCart);
  document.getElementById('close-drawer').addEventListener('click', closeCart);
  document.getElementById('checkout-btn').addEventListener('click', showPayment);

  document.getElementById('pay-login-btn').addEventListener('click', doPayLogin);
  document.getElementById('pay-back-login').addEventListener('click', hidePayment);
  document.getElementById('pay-confirm-btn').addEventListener('click', doConfirmPayment);
  document.getElementById('pay-change-user').addEventListener('click', () => payShowStep('pay-step-login'));
  document.getElementById('pay-new-btn').addEventListener('click', () => {
    hidePayment();
    loggedUser = null;
  });
  document.getElementById('pay-error-retry').addEventListener('click', hidePayment);

  // Enter no login do pagamento
  document.getElementById('pay-gix-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('pay-senha-input').focus();
  });
  document.getElementById('pay-senha-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') doPayLogin();
  });

  updateCartCount();
  renderCart();
});
