// ─── Firebase ───
import { initializeApp } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-app.js";
import {
  getFirestore,
  collection,
  getDocs,
  doc,
  updateDoc,
  runTransaction,
  addDoc,
  serverTimestamp,
  onSnapshot // <-- ADICIONADO para tempo real
} from "https://www.gstatic.com/firebasejs/9.22.1/firebase-firestore.js";
import { getMessaging, getToken } from "https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging.js";

const firebaseConfig = {
  apiKey: "AIzaSyCXFhRZ_Byp40-sIxaNkyICoe066p6J04w",
  authDomain: "banco-sulegal-e93c5.firebaseapp.com",
  projectId: "banco-sulegal-e93c5",
  storageBucket: "banco-sulegal-e93c5.firebasestorage.app",
  messagingSenderId: "917084456664",
  appId: "1:917084456664:web:0fa0ecae429aded7cbb9ad"
};

const app = initializeApp(firebaseConfig);
const db = getFirestore(app);
const messaging = getMessaging(app);

const GIX_LOJA = "SUL873302";
const MAX_QTY = 5;

// ─── State ───
let products = []; // Agora virá do Firestore em tempo real
let cart = {};
let loggedUser = null;
let coupons = [];
let appliedCoupon = null;

// ─── Hash de senha (mesma lógica do Banco One) ───
function ehHashBcrypt(valor) {
  return typeof valor === 'string' && /^\$2[aby]\$\d{2}\$/.test(valor);
}

function pareceHash(valor) {
  return typeof valor === 'string' && /^[a-f0-9]{64}$/i.test(valor);
}

async function gerarHashSenha(nome, senha) {
  const textoComSal = nome.toLowerCase() + ':' + senha;
  const encoder = new TextEncoder();
  const dados = encoder.encode(textoComSal);
  const bufferHash = await crypto.subtle.digest('SHA-256', dados);
  return Array.from(new Uint8Array(bufferHash))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function gerarHashBcrypt(senha) {
  return dcodeIO.bcrypt.hashSync(senha, 10);
}

function verificarBcrypt(senha, hashSalvo) {
  return dcodeIO.bcrypt.compareSync(senha, hashSalvo);
}

async function verificarEMigrarSenha(nome, senhaDigitada, senhaSalva, docId) {
  if (ehHashBcrypt(senhaSalva)) {
    return verificarBcrypt(senhaDigitada, senhaSalva);
  }
  if (pareceHash(senhaSalva)) {
    const hashCalc = await gerarHashSenha(nome, senhaDigitada);
    if (hashCalc !== senhaSalva) return false;
    const novoBcrypt = gerarHashBcrypt(senhaDigitada);
    updateDoc(doc(db, "Contas", docId), { senha: novoBcrypt }).catch(err => console.warn('Erro migração sha256:', err));
    return true;
  }
  if (senhaSalva !== senhaDigitada) return false;
  const novoBcrypt = gerarHashBcrypt(senhaDigitada);
  updateDoc(doc(db, "Contas", docId), { senha: novoBcrypt }).catch(err => console.warn('Erro migração texto puro:', err));
  return true;
}

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
      if (token) console.log('Token FCM:', token);
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

function requestWelcomeNotification() {
  if (!('Notification' in window)) return;
  Notification.requestPermission().then(permission => {
    if (permission === "granted") {
      new Notification("Nova mensagem!", { body: "Bem-vindo ao 5bzon." });
    }
  });
}

// ─── Load products (TEMPO REAL com onSnapshot) ───
function listenToProducts() {
  const q = collection(db, "Produtos"); // Coleção com P maiúsculo
  onSnapshot(q, (snapshot) => {
    // Mapeia para manter compatibilidade com o código existente (name, price, etc.)
    products = snapshot.docs.map(doc => ({
      id: doc.id,
      name: doc.data().nome,
      desc: doc.data().desc,
      price: doc.data().preco,
      emoji: doc.data().emoji || '📦',
      gixVendedor: doc.data().gixVendedor,
      ...doc.data()
    }));
    // Ordena por mais recente primeiro (se tiver timestamp)
    products.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    
    renderProducts();
    renderCart(); // Atualiza carrinho caso preços/nomes mudem em tempo real
  }, (error) => {
    console.error("Erro ao ouvir produtos:", error);
  });
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
    const qty = cart[p.id] || 0;
    const maxed = qty >= MAX_QTY;
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-emoji">${p.emoji}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-desc">${p.desc} <br><span style="font-size:10px; opacity:0.7">Vendedor: ${p.gixVendedor || 'Loja'}</span></div>
      <div class="product-footer">
        <div class="product-price">${p.price} <span>sulegais</span></div>
        <button class="add-btn ${maxed ? 'maxed' : ''}" data-id="${p.id}" ${maxed ? 'disabled' : ''}>
          ${maxed ? '✓ Máx' : '+ Adicionar'}
        </button>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.add-btn').forEach(btn =>
    btn.addEventListener('click', () => addToCart(btn.dataset.id))
  );
}

// ─── Cart ───
function addToCart(id) {
  const qty = cart[id] || 0;
  if (qty >= MAX_QTY) return;
  cart[id] = qty + 1;
  updateUI();
}

function changeQty(id, delta) {
  const qty = (cart[id] || 0) + delta;
  if (qty <= 0) delete cart[id];
  else cart[id] = Math.min(qty, MAX_QTY);
  updateUI();
}

function cartTotal() {
  return Object.entries(cart).reduce((sum, [id, qty]) => {
    const p = products.find(x => x.id === id);
    return sum + (p ? p.price * qty : 0);
  }, 0);
}

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

function updateUI() {
  renderProducts();
  renderCart();
  updateCartCount();
}

function updateCartCount() {
  const total = Object.values(cart).reduce((a, b) => a + b, 0);
  document.getElementById('cart-count').textContent = total;
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');
  const entries = Object.entries(cart).filter(([, q]) => q > 0);

  if (entries.length === 0) {
    container.innerHTML = '<div class="cart-empty">🛒<br/>Carrinho vazio.<br/>Adicione uns quadrinhos aí!</div>';
    if (checkoutBtn) checkoutBtn.disabled = true;
  } else {
    container.innerHTML = '';
    entries.forEach(([id, qty]) => {
      const p = products.find(x => x.id === id);
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
      btn.addEventListener('click', () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta)))
    );
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

// ─── Payment steps ───
function payShowStep(id) {
  ['pay-step-login', 'pay-step-coupon', 'pay-step-paying', 'pay-step-success', 'pay-step-error']
    .forEach(s => {
      document.getElementById(s).style.display = s === id ? 'block' : 'none';
    });
}

function showPayment() {
  if (cartTotal() === 0) return;
  closeCart();
  appliedCoupon = null;
  document.getElementById('pay-gix-input').value = '';
  document.getElementById('pay-senha-input').value = '';
  document.getElementById('pay-login-error').style.display = 'none';
  document.getElementById('pay-valor').textContent = cartTotal();
  payShowStep('pay-step-login');
  document.getElementById('payment-screen').classList.add('visible');
  document.querySelector('.bottom-nav').style.display = 'none';
}

function hidePayment() {
  document.getElementById('payment-screen').classList.remove('visible');
  document.querySelector('.bottom-nav').style.display = '';
}

async function doPayLogin() {
  const gix = document.getElementById('pay-gix-input').value.trim().toUpperCase();
  const senha = document.getElementById('pay-senha-input').value.trim();
  const errEl = document.getElementById('pay-login-error');
  const btn = document.getElementById('pay-login-btn');

  errEl.style.display = 'none';
  if (!gix) { errEl.textContent = 'Informe seu GIX'; errEl.style.display = 'block'; return; }
  if (!senha) { errEl.textContent = 'Informe sua senha'; errEl.style.display = 'block'; return; }

  btn.disabled = true;
  btn.textContent = 'Verificando...';

  try {
    const result = await findByGix(gix);
    if (!result) { errEl.textContent = 'Conta não encontrada'; errEl.style.display = 'block'; return; }

    const senhaOk = await verificarEMigrarSenha(result.id, senha, result.data.senha, result.id);
    if (!senhaOk) { errEl.textContent = 'Senha incorreta'; errEl.style.display = 'block'; return; }
    if (gix === GIX_LOJA.toUpperCase()) { errEl.textContent = 'Use uma conta de cliente'; errEl.style.display = 'block'; return; }

    loggedUser = { docId: result.id, gix, nome: result.data.nome || result.id, saldo: result.data.saldo };
    renderCouponStep();
    payShowStep('pay-step-coupon');
  } catch (e) {
    console.error(e);
    errEl.textContent = 'Erro de conexão. Tente novamente.';
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Entrar →';
  }
}

function renderCouponStep() {
  document.getElementById('pay-coupon-input').value = '';
  document.getElementById('pay-coupon-feedback').style.display = 'none';
  appliedCoupon = null;
  updateCouponSummary();
}

function doApplyCoupon() {
  const code = document.getElementById('pay-coupon-input').value.trim().toUpperCase();
  const fbEl = document.getElementById('pay-coupon-feedback');
  if (!code) {
    fbEl.textContent = 'Digite um código de cupom'; fbEl.className = 'pay-coupon-feedback error'; fbEl.style.display = 'block'; return;
  }
  const found = coupons.find(c => c.code.toUpperCase() === code);
  if (!found) {
    appliedCoupon = null;
    fbEl.textContent = '❌ Cupom inválido'; fbEl.className = 'pay-coupon-feedback error'; fbEl.style.display = 'block';
    updateCouponSummary(); return;
  }
  appliedCoupon = found;
  fbEl.textContent = `✅ ${found.desc}`; fbEl.className = 'pay-coupon-feedback success'; fbEl.style.display = 'block';
  updateCouponSummary();
}

function doRemoveCoupon() {
  appliedCoupon = null;
  document.getElementById('pay-coupon-input').value = '';
  document.getElementById('pay-coupon-feedback').style.display = 'none';
  updateCouponSummary();
}

function updateCouponSummary() {
  const raw = cartTotal();
  const total = cartTotalWithDiscount();
  const discount = raw - total;

  document.getElementById('pay-coupon-original').textContent = raw + ' sulegais';
  document.getElementById('pay-coupon-final').textContent = total + ' sulegais';

  const discountEl = document.getElementById('pay-coupon-discount-row');
  const summaryEl = document.getElementById('pay-coupon-summary');

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

function doContinueFromCoupon() {
  const raw = cartTotal();
  const total = cartTotalWithDiscount();
  const discount = raw - total;

  document.getElementById('pay-user-name').textContent = loggedUser.nome;
  document.getElementById('pay-user-gix').textContent = 'GIX: ' + loggedUser.gix;
  document.getElementById('pay-user-saldo').textContent = loggedUser.saldo + ' sulegais';
  document.getElementById('pay-valor2').textContent = total;

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
  document.getElementById('pay-saldo-warn').style.display = semSaldo ? 'block' : 'none';
  document.getElementById('pay-confirm-btn').disabled = semSaldo;
  document.getElementById('pay-paying-error').style.display = 'none';

  payShowStep('pay-step-paying');
}

// ─── CHECKOUT MULTI-VENDEDOR PROPORCIONAL ───
async function doConfirmPayment() {
  const totalToPay = cartTotalWithDiscount();
  const rawTotal = cartTotal();
  const discount = rawTotal - totalToPay;
  const btn = document.getElementById('pay-confirm-btn');
  const errEl = document.getElementById('pay-paying-error');

  errEl.style.display = 'none';
  btn.disabled = true;
  btn.textContent = 'Processando...';

  try {
    // 1. Agrupar itens do carrinho por vendedor
    const sellerTallies = {}; 
    
    for (const [id, qty] of Object.entries(cart)) {
      const p = products.find(x => x.id === id);
      if (!p) continue;
      
      const gix = p.gixVendedor || GIX_LOJA; // Fallback para a loja se não tiver vendedor
      const itemRaw = p.price * qty;

      if (!sellerTallies[gix]) {
        sellerTallies[gix] = { raw: 0, final: 0, items: [] };
      }
      sellerTallies[gix].raw += itemRaw;
      sellerTallies[gix].items.push(`${p.name} (x${qty})`);
    }

    // 2. Calcular desconto proporcional para cada vendedor
    for (const gix in sellerTallies) {
      const ratio = sellerTallies[gix].raw / rawTotal;
      const sellerDiscount = Math.floor(discount * ratio);
      sellerTallies[gix].discount = sellerDiscount;
      sellerTallies[gix].final = sellerTallies[gix].raw - sellerDiscount;
    }

    // 3. Ajustar erros de arredondamento para garantir que a soma bata exatamente com o totalToPay
    let currentSum = Object.values(sellerTallies).reduce((acc, curr) => acc + curr.final, 0);
    if (currentSum !== totalToPay && Object.keys(sellerTallies).length > 0) {
      const firstGix = Object.keys(sellerTallies)[0];
      sellerTallies[firstGix].final += (totalToPay - currentSum);
    }

    // 4. Executar transação atômica no Firestore
    await runTransaction(db, async (t) => {
      const userRef = doc(db, "Contas", loggedUser.docId);
      const userSnap = await t.get(userRef);
      if (!userSnap.exists()) throw new Error('Conta não encontrada');
      if (userSnap.data().saldo < totalToPay) throw new Error('Saldo insuficiente');

      // Deduz do comprador
      t.update(userRef, { saldo: userSnap.data().saldo - totalToPay });

      // Adiciona a cada vendedor proporcionalmente
      for (const gix in sellerTallies) {
        const sellerData = await findByGix(gix);
        if (sellerData) {
          const sellerRef = doc(db, "Contas", sellerData.id);
          const sellerSnap = await t.get(sellerRef);
          if (sellerSnap.exists()) {
            const novoSaldo = (sellerSnap.data().saldo || 0) + sellerTallies[gix].final;
            t.update(sellerRef, { saldo: novoSaldo });
          }
        }
      }

      // 5. Registrar o aviso da transação
      await addDoc(collection(db, "avisos"), {
        gix: loggedUser.gix,
        nome: loggedUser.nome,
        detalhesVendedores: Object.entries(sellerTallies).map(([gix, data]) => ({
          gix,
          valorRecebido: data.final,
          itens: data.items
        })),
        total: totalToPay,
        cupom: appliedCoupon ? appliedCoupon.code : null,
        timestamp: serverTimestamp()
      });
    });

    // Sucesso
    document.getElementById('pay-success-valor').textContent = totalToPay;
    document.getElementById('pay-success-nome').textContent = loggedUser.nome;
    payShowStep('pay-step-success');

    cart = {};
    appliedCoupon = null;
    updateUI();

  } catch (e) {
    console.error(e);
    const msg = e.message === 'Saldo insuficiente' ? 'Saldo insuficiente para esta compra.' : 'Falha na transação. Tente novamente.';
    errEl.textContent = msg;
    errEl.style.display = 'block';
    btn.disabled = false;
    btn.textContent = 'Confirmar pagamento';
  }
}

// ─── Init ───
document.addEventListener('DOMContentLoaded', () => {
  runIntro();
  listenToProducts(); // <-- Substitui loadProducts()
  loadCoupons();
  requestWelcomeNotification();
  setupNotifications();

  // Nav tabs
  const homeTab = document.getElementById("home-tab");
  const publishTab = document.getElementById("publish-tab");
  const cartTab = document.getElementById("cart-tab");

  homeTab.addEventListener("click", () => {
    homeTab.classList.add("active");
    publishTab.classList.remove("active");
    cartTab.classList.remove("active");
    closeCart();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });

  publishTab.addEventListener("click", () => {
    publishTab.classList.add("active");
    homeTab.classList.remove("active");
    cartTab.classList.remove("active");
    document.getElementById('publishOverlay').classList.add('open');
  });

  cartTab.addEventListener("click", () => {
    cartTab.classList.add("active");
    homeTab.classList.remove("active");
    publishTab.classList.remove("active");
    openCart();
  });

  // Overlay click
  document.getElementById('overlay').addEventListener('click', () => {
    closeCart();
    homeTab.classList.add("active");
    cartTab.classList.remove("active");
  });

  // ─── Lógica do Modal de Publicação ───
  const publishOverlay = document.getElementById('publishOverlay');
  const closePublish = document.getElementById('closePublish');
  const pubSubmitBtn = document.getElementById('pub-submit-btn');
  const pubError = document.getElementById('pub-error');

  closePublish.addEventListener('click', () => {
    publishOverlay.classList.remove('open');
    pubError.style.display = 'none';
  });

  publishOverlay.addEventListener('click', (e) => {
    if (e.target === publishOverlay) {
      publishOverlay.classList.remove('open');
      pubError.style.display = 'none';
    }
  });

  pubSubmitBtn.addEventListener('click', async () => {
    const gix = document.getElementById('pub-gix').value.trim().toUpperCase();
    const nome = document.getElementById('pub-nome').value.trim();
    const desc = document.getElementById('pub-desc').value.trim();
    const preco = parseFloat(document.getElementById('pub-preco').value);
    const emoji = document.getElementById('pub-emoji').value.trim() || '📦';

    pubError.style.display = 'none';

    if (!gix || !nome || !preco || isNaN(preco) || preco <= 0) {
      pubError.textContent = 'Preencha todos os campos corretamente (preço deve ser > 0).';
      pubError.style.display = 'block';
      return;
    }

    pubSubmitBtn.disabled = true;
    pubSubmitBtn.textContent = 'Verificando GIX...';

    try {
      // Valida se o GIX existe
      const vendedor = await findByGix(gix);
      if (!vendedor) {
        pubError.textContent = 'GIX não encontrado. Verifique o código do vendedor.';
        pubError.style.display = 'block';
        pubSubmitBtn.disabled = false;
        pubSubmitBtn.textContent = 'Publicar produto';
        return;
      }

      pubSubmitBtn.textContent = 'Publicando...';

      // Salva na coleção Produtos (P maiúsculo)
      await addDoc(collection(db, "Produtos"), {
        nome,
        desc,
        preco,
        emoji,
        gixVendedor: gix,
        nomeVendedor: vendedor.data.nome || gix,
        timestamp: serverTimestamp()
      });

      // Limpa formulário e fecha modal
      document.getElementById('pub-gix').value = '';
      document.getElementById('pub-nome').value = '';
      document.getElementById('pub-desc').value = '';
      document.getElementById('pub-preco').value = '';
      document.getElementById('pub-emoji').value = '';
      publishOverlay.classList.remove('open');
      
      // O onSnapshot já vai atualizar a tela automaticamente!

    } catch (e) {
      console.error(e);
      pubError.textContent = 'Erro ao publicar. Tente novamente.';
      pubError.style.display = 'block';
    } finally {
      pubSubmitBtn.disabled = false;
      pubSubmitBtn.textContent = 'Publicar produto';
    }
  });

  // Botão Finalizar Compra
  const checkoutBtn = document.getElementById('checkout-btn');
  checkoutBtn.disabled = true;
  checkoutBtn.addEventListener('click', () => {
    if (cartTotal() > 0) showPayment();
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
