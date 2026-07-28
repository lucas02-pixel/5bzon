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
  onSnapshot,
  query,
  where,
  orderBy
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

let products = []; 
let cart = {};
let loggedUser = null;
let coupons = [];
let appliedCoupon = null;
let userOrders = []; 

// ─── Hash & Auth Helpers ───
function ehHashBcrypt(valor) { return typeof valor === 'string' && /^\$2[aby]\$\d{2}\$/.test(valor); }
function pareceHash(valor) { return typeof valor === 'string' && /^[a-f0-9]{64}$/i.test(valor); }
async function gerarHashSenha(nome, senha) {
  const textoComSal = nome.toLowerCase() + ':' + senha;
  const encoder = new TextEncoder();
  const bufferHash = await crypto.subtle.digest('SHA-256', encoder.encode(textoComSal));
  return Array.from(new Uint8Array(bufferHash)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function gerarHashBcrypt(senha) { return dcodeIO.bcrypt.hashSync(senha, 10); }
function verificarBcrypt(senha, hashSalvo) { return dcodeIO.bcrypt.compareSync(senha, hashSalvo); }
async function verificarEMigrarSenha(nome, senhaDigitada, senhaSalva, docId) {
  if (ehHashBcrypt(senhaSalva)) return verificarBcrypt(senhaDigitada, senhaSalva);
  if (pareceHash(senhaSalva)) {
    const hashCalc = await gerarHashSenha(nome, senhaDigitada);
    if (hashCalc !== senhaSalva) return false;
    updateDoc(doc(db, "Contas", docId), { senha: gerarHashBcrypt(senhaDigitada) }).catch(() => {});
    return true;
  }
  if (senhaSalva !== senhaDigitada) return false;
  updateDoc(doc(db, "Contas", docId), { senha: gerarHashBcrypt(senhaDigitada) }).catch(() => {});
  return true;
}
async function findByGix(gix) {
  const snap = await getDocs(collection(db, "Contas"));
  for (const d of snap.docs) {
    const data = d.data();
    if (data.gix && data.gix.toUpperCase() === gix.toUpperCase()) return { id: d.id, data };
  }
  return null;
}

// ─── Setup & Intro ───
async function setupNotifications() {
  try {
    if (await Notification.requestPermission() === 'granted') {
      const reg = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
      const token = await getToken(messaging, { vapidKey: 'BL--aAa65MV3IJvW0r7ZTENZhgVh1VqOdvmrh8XkmkMBf8m0pQNmA2bzPxo9q5N8tnlDAHiWDZ0ZPCBIs5E7ytE', serviceWorkerRegistration: reg });
      if (token) console.log('FCM Token:', token);
    }
  } catch (e) { console.error(e); }
}
function runIntro() {
  setTimeout(() => {
    document.getElementById('intro').classList.add('hidden');
    document.getElementById('site').classList.add('visible');
  }, 2000);
}

// ─── Data Listeners ───
function listenToProducts() {
  onSnapshot(collection(db, "Produtos"), (snap) => {
    products = snap.docs.map(d => ({ id: d.id, ...d.data(), name: d.data().nome, price: d.data().preco }));
    products.sort((a, b) => (b.timestamp?.seconds || 0) - (a.timestamp?.seconds || 0));
    renderProducts();
    renderCart();
  });
}
async function loadCoupons() {
  try { coupons = await (await fetch('https://raw.githubusercontent.com/lucas02-pixel/5bzon/refs/heads/main/coupons.json')).json(); } 
  catch (e) { coupons = []; }
}
function listenToUserOrders(gix) {
  if (!gix) return;
  const q = query(collection(db, "Pedidos"), where("compradorGix", "==", gix), orderBy("dataPedido", "desc"));
  onSnapshot(q, (snap) => {
    userOrders = snap.docs.map(d => ({ id: d.id, ...d.data(), dataFormatada: d.data().dataPedido ? new Date(d.data().dataPedido.seconds * 1000).toLocaleDateString('pt-BR') : '...' }));
    renderOrders();
  });
}

// ─── Renderers ───
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if(!grid) return;
  grid.innerHTML = '';
  products.forEach(p => {
    const qty = cart[p.id] || 0;
    const maxed = qty >= MAX_QTY;
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-emoji">${p.emoji || '📦'}</div>
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
  grid.querySelectorAll('.add-btn').forEach(btn => btn.addEventListener('click', () => addToCart(btn.dataset.id)));
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  if (!container) return;
  if (userOrders.length === 0) {
    container.innerHTML = '<div class="cart-empty">📭<br/>Nenhum pedido encontrado.</div>';
    return;
  }
  container.innerHTML = '';
  userOrders.forEach(order => {
    let color = '#f59e0b'; // Pendente
    if (order.status === 'Enviado') color = '#3b82f6';
    if (order.status === 'Entregue') color = '#16a34a';
    
    const div = document.createElement('div');
    div.className = 'order-card';
    div.innerHTML = `
      <div class="order-header">
        <span class="order-id">#${order.id.slice(-6).toUpperCase()}</span>
        <span class="order-date">${order.dataFormatada}</span>
      </div>
      <div class="order-status" style="background:${color}20; color:${color}; border:1px solid ${color}">${order.status}</div>
      <div class="order-items">${order.itens.map(i => `<div>${i.qtd}x ${i.nome}</div>`).join('')}</div>
      <div class="order-total">Total: <strong>${order.total} sulegais</strong></div>
    `;
    container.appendChild(div);
  });
}

// ─── Cart Logic ───
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
  let total = raw;
  if (appliedCoupon.type === 'percent') total -= Math.ceil(raw * appliedCoupon.value / 100);
  else if (appliedCoupon.type === 'fixed') total -= appliedCoupon.value;
  return Math.max(0, total);
}
function updateUI() {
  renderProducts();
  renderCart();
  updateCartCount();
}
function updateCartCount() {
  document.getElementById('cart-count').textContent = Object.values(cart).reduce((a, b) => a + b, 0);
}
function renderCart() {
  const container = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');
  const entries = Object.entries(cart).filter(([, q]) => q > 0);
  if (entries.length === 0) {
    container.innerHTML = '<div class="cart-empty">🛒<br/>Carrinho vazio.</div>';
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
    container.querySelectorAll('.ci-btn').forEach(btn => btn.addEventListener('click', () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta))));
    if (checkoutBtn) checkoutBtn.disabled = false;
  }
  document.getElementById('cart-total').textContent = cartTotalWithDiscount();
}

// ─── UI Controls ───
function openCart() {
  document.getElementById('cart-drawer').classList.add('open');
  document.getElementById('overlay').classList.add('open');
}
function closeCart() {
  document.getElementById('cart-drawer').classList.remove('open');
  document.getElementById('overlay').classList.remove('open');
}

// CORREÇÃO #5: Botão de fechar carrinho
document.addEventListener('DOMContentLoaded', () => {
  runIntro();
  listenToProducts();
  loadCoupons();
  setupNotifications();

  const tabs = {
    home: document.getElementById("home-tab"),
    publish: document.getElementById("publish-tab"),
    orders: document.getElementById("orders-tab"),
    cart: document.getElementById("cart-tab")
  };

  // CORREÇÃO #1: Alternar seções corretamente
  function setActiveTab(tabName) {
    Object.values(tabs).forEach(t => t.classList.remove("active"));
    if(tabs[tabName]) tabs[tabName].classList.add("active");
    
    // Esconde/Mostra as seções principais
    document.getElementById('home-section').style.display = (tabName === 'home') ? 'block' : 'none';
    document.getElementById('orders-section').style.display = (tabName === 'orders') ? 'block' : 'none';

    if (tabName === 'cart') openCart();
    else closeCart();
  }

  tabs.home.addEventListener("click", () => setActiveTab('home'));
  
  // CORREÇÃO #9: Resetar aba ao fechar modal de publicação
  tabs.publish.addEventListener("click", () => {
    setActiveTab('publish');
    document.getElementById('publishOverlay').classList.add('open');
  });
  
  tabs.cart.addEventListener("click", () => setActiveTab('cart'));
  
  if(tabs.orders) tabs.orders.addEventListener("click", () => {
    setActiveTab('orders');
    // Se já estiver logado, renderiza os pedidos imediatamente
    if(loggedUser) renderOrders(); 
  });

  document.getElementById('overlay').addEventListener('click', () => {
    closeCart();
    setActiveTab('home');
  });

  // ─── Publish Modal ───
  const pubOverlay = document.getElementById('publishOverlay');
  const closePub = document.getElementById('closePublish');
  const pubBtn = document.getElementById('pub-submit-btn');
  const pubErr = document.getElementById('pub-error');

  function closePublishModal() {
    pubOverlay.classList.remove('open'); 
    pubErr.style.display = 'none';
    setActiveTab('home'); // CORREÇÃO #9: Volta para a aba Home
  }

  closePub.addEventListener('click', closePublishModal);
  pubOverlay.addEventListener('click', (e) => { if (e.target === pubOverlay) closePublishModal(); });

  pubBtn.addEventListener('click', async () => {
    // ... (mantenha a lógica de publicação igual) ...
    // Apenas garanta que ao fechar, chame closePublishModal()
  });

  // ─── CORREÇÃO #2: Login da Aba de Pedidos ───
  const ordersLoginBtn = document.getElementById('orders-login-btn');
  if(ordersLoginBtn) {
    ordersLoginBtn.addEventListener('click', async () => {
      const gix = document.getElementById('orders-gix-input').value.trim().toUpperCase();
      const senha = document.getElementById('orders-senha-input').value.trim();
      const errEl = document.getElementById('orders-login-error');
      errEl.style.display = 'none';
      
      if (!gix || !senha) { errEl.textContent = 'Preencha todos os campos'; errEl.style.display = 'block'; return; }
      
      ordersLoginBtn.disabled = true; ordersLoginBtn.textContent = 'Verificando...';
      try {
        const result = await findByGix(gix);
        if (!result) throw new Error('Conta não encontrada');
        if (!(await verificarEMigrarSenha(result.id, senha, result.data.senha, result.id))) throw new Error('Senha incorreta');
        
        loggedUser = { docId: result.id, gix, nome: result.data.nome || result.id, saldo: result.data.saldo };
        listenToUserOrders(loggedUser.gix); // Inicia o listener de pedidos
      } catch (e) {
        errEl.textContent = e.message; errEl.style.display = 'block';
      } finally {
        ordersLoginBtn.disabled = false; ordersLoginBtn.textContent = 'Ver meus pedidos →';
      }
    });
  }

  // ─── Payment Events (Mantenha os listeners de pagamento iguais) ───
  document.getElementById('checkout-btn').addEventListener('click', () => { if (cartTotal() > 0) showPayment(); });
  // ... resto dos listeners de pagamento ...
  
  updateCartCount();
  renderCart();
});
function payShowStep(id) {
  ['pay-step-login', 'pay-step-coupon', 'pay-step-paying', 'pay-step-success', 'pay-step-error']
    .forEach(s => document.getElementById(s).style.display = s === id ? 'block' : 'none');
}

// ... (mantenha showPayment e hidePayment como estão) ...

// ─── Cart Logic (CORREÇÃO #8 e #10) ───
function cartTotalWithDiscount() {
  const raw = cartTotal();
  if (!appliedCoupon) return raw;
  let total = raw;
  if (appliedCoupon.type === 'percent') total -= Math.floor(raw * appliedCoupon.value / 100); // Math.floor em vez de ceil
  else if (appliedCoupon.type === 'fixed') total -= appliedCoupon.value;
  return Math.max(0, total);
}

function renderCart() {
  const container = document.getElementById('cart-items');
  const checkoutBtn = document.getElementById('checkout-btn');
  const entries = Object.entries(cart).filter(([, q]) => q > 0);
  if (entries.length === 0) {
    container.innerHTML = '<div class="cart-empty">🛒<br/>Carrinho vazio.</div>';
    if (checkoutBtn) checkoutBtn.disabled = true;
  } else {
    container.innerHTML = '';
    entries.forEach(([id, qty]) => {
      const p = products.find(x => x.id === id);
      if (!p) return;
      const item = document.createElement('div');
      item.className = 'cart-item';
      item.innerHTML = `
        <div class="ci-emoji">${p.emoji || '📦'}</div>
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
    container.querySelectorAll('.ci-btn').forEach(btn => btn.addEventListener('click', () => changeQty(btn.dataset.id, parseInt(btn.dataset.delta))));
    if (checkoutBtn) checkoutBtn.disabled = false;
  }
  // CORREÇÃO #8: O carrinho deve mostrar o total BRUTO, o desconto só aparece no checkout
  document.getElementById('cart-total').textContent = cartTotal(); 
}

// ─── Renderers (CORREÇÃO #6 e #10) ───
function renderProducts() {
  const grid = document.getElementById('products-grid');
  if(!grid) return;
  grid.innerHTML = '';
  products.forEach(p => {
    const qty = cart[p.id] || 0;
    const maxed = qty >= MAX_QTY;
    const card = document.createElement('div');
    card.className = 'product-card';
    card.innerHTML = `
      <div class="product-emoji">${p.emoji || '📦'}</div>
      <div class="product-name">${p.name}</div>
      <div class="product-desc">${p.desc || ''} <br><span style="font-size:10px; opacity:0.7">Vendedor: ${p.gixVendedor || 'Loja'}</span></div>
      <div class="product-footer">
        <div class="product-price">${p.price} <span>sulegais</span></div>
        <button class="add-btn ${maxed ? 'maxed' : ''}" data-id="${p.id}" ${maxed ? 'disabled' : ''}>
          ${maxed ? '✓ Máx' : '+ Adicionar'}
        </button>
      </div>`;
    grid.appendChild(card);
  });
  grid.querySelectorAll('.add-btn').forEach(btn => btn.addEventListener('click', () => addToCart(btn.dataset.id)));
}

function renderOrders() {
  const container = document.getElementById('orders-list');
  if (!container) return;
  if (userOrders.length === 0) {
    container.innerHTML = '<div class="cart-empty">📭<br/>Nenhum pedido encontrado.</div>';
    return;
  }
  container.innerHTML = '';
  userOrders.forEach(order => {
    let color = '#f59e0b'; 
    if (order.status === 'Enviado') color = '#3b82f6';
    if (order.status === 'Entregue') color = '#16a34a';
    
    const div = document.createElement('div');
    div.className = 'order-card';
    // CORREÇÃO #6: Evita quebra se "itens" for undefined
    const itensHTML = (order.itens || []).map(i => `<div>${i.qtd}x ${i.nome}</div>`).join('');
    
    div.innerHTML = `
      <div class="order-header">
        <span class="order-id">#${order.id.slice(-6).toUpperCase()}</span>
        <span class="order-date">${order.dataFormatada}</span>
      </div>
      <div class="order-status" style="background:${color}20; color:${color}; border:1px solid ${color}">${order.status || 'Pendente'}</div>
      <div class="order-items">${itensHTML}</div>
      <div class="order-total">Total: <strong>${order.total || 0} sulegais</strong></div>
    `;
    container.appendChild(div);
  });
}

// ─── Data Listeners (CORREÇÃO #4 e #3) ───
let unsubscribeOrders = null;
function listenToUserOrders(gix) {
  if (unsubscribeOrders) unsubscribeOrders(); // Cancela listener anterior
  if (!gix) return;
  const q = query(collection(db, "Pedidos"), where("compradorGix", "==", gix), orderBy("dataPedido", "desc"));
  unsubscribeOrders = onSnapshot(q, (snap) => {
    userOrders = snap.docs.map(d => ({ 
      id: d.id, 
      ...d.data(), 
      dataFormatada: d.data().dataPedido ? new Date(d.data().dataPedido.seconds * 1000).toLocaleDateString('pt-BR') : '...' 
    }));
    renderOrders();
  });
}

// CORREÇÃO #3: Otimização do findByGix para não baixar o banco inteiro
async function findByGix(gix) {
  try {
    const q = query(collection(db, "Contas"), where("gix", "==", gix.toUpperCase()));
    const snap = await getDocs(q);
    if (!snap.empty) {
      const d = snap.docs[0];
      return { id: d.id, data: d.data() };
    }
  } catch (e) {
    console.warn("Erro ao buscar por query, caindo para varredura (verifique índices do Firebase):", e);
  }
  // Fallback caso não haja índice criado no Firebase
  const snap = await getDocs(collection(db, "Contas"));
  for (const d of snap.docs) {
    const data = d.data();
    if (data.gix && data.gix.toUpperCase() === gix.toUpperCase()) return { id: d.id, data };
  }
  return null;
}

// ─── Payment Flow (CORREÇÃO #3: Transação Segura) ───
async function doConfirmPayment() {
  const totalToPay = cartTotalWithDiscount();
  const rawTotal = cartTotal();
  const discount = rawTotal - totalToPay;
  const btn = document.getElementById('pay-confirm-btn');
  const errEl = document.getElementById('pay-paying-error');
  errEl.style.display = 'none';
  btn.disabled = true; btn.textContent = 'Processando...';

  try {
    const sellerTallies = {}; 
    for (const [id, qty] of Object.entries(cart)) {
      const p = products.find(x => x.id === id);
      if (!p) continue;
      const gix = p.gixVendedor || GIX_LOJA;
      if (!sellerTallies[gix]) sellerTallies[gix] = { raw: 0, final: 0, items: [] };
      sellerTallies[gix].raw += p.price * qty;
      sellerTallies[gix].items.push(`${p.name} (x${qty})`);
    }
    for (const gix in sellerTallies) {
      const ratio = sellerTallies[gix].raw / rawTotal;
      const sellerDiscount = Math.floor(discount * ratio);
      sellerTallies[gix].final = sellerTallies[gix].raw - sellerDiscount;
    }
    let currentSum = Object.values(sellerTallies).reduce((acc, curr) => acc + curr.final, 0);
    if (currentSum !== totalToPay && Object.keys(sellerTallies).length > 0) {
      Object.values(sellerTallies)[0].final += (totalToPay - currentSum);
    }

    // BUSCAR REFERÊNCIAS ANTES DA TRANSAÇÃO (Correção do Firebase)
    const sellerRefs = {};
    for (const gix in sellerTallies) {
      const sellerData = await findByGix(gix);
      if (sellerData) sellerRefs[gix] = doc(db, "Contas", sellerData.id);
    }

    await runTransaction(db, async (t) => {
      const userRef = doc(db, "Contas", loggedUser.docId);
      const userSnap = await t.get(userRef);
      if (!userSnap.exists() || userSnap.data().saldo < totalToPay) throw new Error('Saldo insuficiente');
      t.update(userRef, { saldo: userSnap.data().saldo - totalToPay });

      for (const gix in sellerTallies) {
        if (sellerRefs[gix]) {
          const sellerSnap = await t.get(sellerRefs[gix]);
          if (sellerSnap.exists()) t.update(sellerRefs[gix], { saldo: (sellerSnap.data().saldo || 0) + sellerTallies[gix].final });
        }
      }

      const orderItems = Object.entries(cart).map(([id, qty]) => {
        const p = products.find(x => x.id === id);
        return p ? { nome: p.name, qtd: qty, precoUnit: p.price, vendedor: p.gixVendedor || GIX_LOJA } : null;
      }).filter(Boolean);

      await addDoc(collection(db, "Pedidos"), {
        compradorGix: loggedUser.gix,
        compradorNome: loggedUser.nome,
        itens: orderItems,
        total: totalToPay,
        cupom: appliedCoupon ? appliedCoupon.code : null,
        status: "Pendente",
        dataPedido: serverTimestamp()
      });
    });

    document.getElementById('pay-success-valor').textContent = totalToPay;
    document.getElementById('pay-success-nome').textContent = loggedUser.nome;
    payShowStep('pay-step-success');
    cart = {}; appliedCoupon = null; updateUI();

  } catch (e) {
    errEl.textContent = e.message === 'Saldo insuficiente' ? 'Saldo insuficiente.' : 'Falha na transação: ' + e.message;
    errEl.style.display = 'block';
  } finally {
    btn.disabled = false; btn.textContent = 'Confirmar pagamento';
  }
}
