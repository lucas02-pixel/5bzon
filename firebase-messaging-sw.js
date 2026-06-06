// Importa os scripts do Firebase para o Service Worker
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/9.22.1/firebase-messaging-compat.js');

const firebaseConfig = {
  apiKey: "AIzaSyCXFhRZ_Byp40-sIxaNkyICoe066p6J04w",
  authDomain: "banco-sulegal-e93c5.firebaseapp.com",
  projectId: "banco-sulegal-e93c5",
  storageBucket: "banco-sulegal-e93c5.firebasestorage.app",
  messagingSenderId: "917084456664",
  appId: "1:917084456664:web:0fa0ecae429aded7cbb9ad"
};

// Inicializa o Firebase
firebase.initializeApp(firebaseConfig);

const messaging = firebase.messaging();

// Deixe o método de segundo plano apenas registrando no console se quiser, 
// ou remova-o se preferir. O Firebase cuidará de exibir a notificação do painel.
messaging.onBackgroundMessage((payload) => {
  console.log('Notificação recebida do console em segundo plano:', payload);
});