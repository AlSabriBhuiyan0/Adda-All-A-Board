// Internationalization (i18n) Support
const translations = {
  en: {
    // Auth
    login: 'Login',
    register: 'Register',
    email: 'Email',
    password: 'Password',
    username: 'Username',
    createAccount: 'Create Account',
    logout: 'Logout',
    
    // Lobby
    chooseGame: 'Choose a Game',
    quickPlay: 'Quick Play',
    offline: 'Offline',
    activeGames: 'Active Games',
    savedGames: 'Saved Games',
    leaderboard: 'Leaderboard',
    friends: 'Friends',
    addFriend: 'Add Friend',
    
    // Games
    ludoKing: 'Ludo King',
    monopoly: 'Monopoly',
    uno: 'UNO',
    players: 'Players',
    theme: 'Theme',
    classic: 'Classic',
    candy: 'Candy',
    pirate: 'Pirate',
    christmas: 'Christmas',
    
    // Game actions
    rollDice: 'Roll Dice',
    yourTurn: 'Your Turn',
    exit: 'Exit',
    saveGame: 'Save Game',
    resume: 'Resume',
    
    // Common
    loading: 'Loading...',
    error: 'Error',
    success: 'Success',
    cancel: 'Cancel',
    confirm: 'Confirm',
    save: 'Save',
    delete: 'Delete',
    remove: 'Remove',
    accept: 'Accept',
    reject: 'Reject',
    invite: 'Invite',
    send: 'Send',
    
    // Messages
    noActiveGames: 'No active games. Create one!',
    noSavedGames: 'No saved games',
    noFriends: 'No friends yet. Add some!',
    gameSaved: 'Game saved!',
    friendRequestSent: 'Friend request sent!',
    enterUsername: 'Enter username'
  },
  es: {
    login: 'Iniciar sesión',
    register: 'Registrarse',
    email: 'Correo electrónico',
    password: 'Contraseña',
    username: 'Nombre de usuario',
    createAccount: 'Crear cuenta',
    logout: 'Cerrar sesión',
    chooseGame: 'Elige un juego',
    quickPlay: 'Juego rápido',
    offline: 'Sin conexión',
    activeGames: 'Juegos activos',
    savedGames: 'Juegos guardados',
    leaderboard: 'Clasificación',
    friends: 'Amigos',
    addFriend: 'Agregar amigo',
    ludoKing: 'Ludo Rey',
    monopoly: 'Monopolio',
    uno: 'UNO',
    players: 'Jugadores',
    theme: 'Tema',
    classic: 'Clásico',
    candy: 'Caramelo',
    pirate: 'Pirata',
    christmas: 'Navidad',
    rollDice: 'Tirar dados',
    yourTurn: 'Tu turno',
    exit: 'Salir',
    saveGame: 'Guardar juego',
    resume: 'Reanudar',
    loading: 'Cargando...',
    error: 'Error',
    success: 'Éxito',
    cancel: 'Cancelar',
    confirm: 'Confirmar',
    save: 'Guardar',
    delete: 'Eliminar',
    remove: 'Quitar',
    accept: 'Aceptar',
    reject: 'Rechazar',
    invite: 'Invitar',
    send: 'Enviar',
    noActiveGames: 'No hay juegos activos. ¡Crea uno!',
    noSavedGames: 'No hay juegos guardados',
    noFriends: 'Aún no tienes amigos. ¡Agrega algunos!',
    gameSaved: '¡Juego guardado!',
    friendRequestSent: '¡Solicitud de amistad enviada!',
    enterUsername: 'Ingresa nombre de usuario'
  },
  hi: {
    login: 'लॉगिन',
    register: 'पंजीकरण',
    email: 'ईमेल',
    password: 'पासवर्ड',
    username: 'उपयोगकर्ता नाम',
    createAccount: 'खाता बनाएं',
    logout: 'लॉगआउट',
    chooseGame: 'एक गेम चुनें',
    quickPlay: 'त्वरित खेल',
    offline: 'ऑफ़लाइन',
    activeGames: 'सक्रिय गेम',
    savedGames: 'सहेजे गए गेम',
    leaderboard: 'लीडरबोर्ड',
    friends: 'दोस्त',
    addFriend: 'दोस्त जोड़ें',
    ludoKing: 'लूडो किंग',
    monopoly: 'मोनोपॉली',
    uno: 'UNO',
    players: 'खिलाड़ी',
    theme: 'थीम',
    classic: 'क्लासिक',
    candy: 'कैंडी',
    pirate: 'समुद्री डाकू',
    christmas: 'क्रिसमस',
    rollDice: 'पासा फेंकें',
    yourTurn: 'आपकी बारी',
    exit: 'बाहर निकलें',
    saveGame: 'गेम सहेजें',
    resume: 'फिर से शुरू करें',
    loading: 'लोड हो रहा है...',
    error: 'त्रुटि',
    success: 'सफलता',
    cancel: 'रद्द करें',
    confirm: 'पुष्टि करें',
    save: 'सहेजें',
    delete: 'हटाएं',
    remove: 'हटाएं',
    accept: 'स्वीकार करें',
    reject: 'अस्वीकार करें',
    invite: 'आमंत्रित करें',
    send: 'भेजें',
    noActiveGames: 'कोई सक्रिय गेम नहीं। एक बनाएं!',
    noSavedGames: 'कोई सहेजे गए गेम नहीं',
    noFriends: 'अभी तक कोई दोस्त नहीं। कुछ जोड़ें!',
    gameSaved: 'गेम सहेजा गया!',
    friendRequestSent: 'मित्र अनुरोध भेजा गया!',
    enterUsername: 'उपयोगकर्ता नाम दर्ज करें'
  },
  bn: {
    login: 'লগইন',
    register: 'নিবন্ধন',
    email: 'ইমেইল',
    password: 'পাসওয়ার্ড',
    username: 'ব্যবহারকারীর নাম',
    createAccount: 'অ্যাকাউন্ট তৈরি করুন',
    logout: 'লগআউট',
    chooseGame: 'একটি গেম বেছে নিন',
    quickPlay: 'দ্রুত খেলা',
    offline: 'অফলাইন',
    activeGames: 'সক্রিয় গেম',
    savedGames: 'সংরক্ষিত গেম',
    leaderboard: 'লিডারবোর্ড',
    friends: 'বন্ধু',
    addFriend: 'বন্ধু যোগ করুন',
    ludoKing: 'লুডো কিং',
    monopoly: 'মনোপলি',
    uno: 'UNO',
    players: 'খেলোয়াড়',
    theme: 'থিম',
    classic: 'ক্লাসিক',
    candy: 'ক্যান্ডি',
    pirate: 'সমুদ্র ডাকাত',
    christmas: 'ক্রিসমাস',
    rollDice: 'পাশা নিক্ষেপ',
    yourTurn: 'আপনার পালা',
    exit: 'প্রস্থান',
    saveGame: 'গেম সংরক্ষণ করুন',
    resume: 'পুনরায় শুরু করুন',
    loading: 'লোড হচ্ছে...',
    error: 'ত্রুটি',
    success: 'সাফল্য',
    cancel: 'বাতিল',
    confirm: 'নিশ্চিত করুন',
    save: 'সংরক্ষণ',
    delete: 'মুছুন',
    remove: 'সরান',
    accept: 'গ্রহণ করুন',
    reject: 'প্রত্যাখ্যান',
    invite: 'আমন্ত্রণ',
    send: 'পাঠান',
    noActiveGames: 'কোন সক্রিয় গেম নেই। একটি তৈরি করুন!',
    noSavedGames: 'কোন সংরক্ষিত গেম নেই',
    noFriends: 'এখনও কোন বন্ধু নেই। কিছু যোগ করুন!',
    gameSaved: 'গেম সংরক্ষিত হয়েছে!',
    friendRequestSent: 'বন্ধুর অনুরোধ পাঠানো হয়েছে!',
    enterUsername: 'ব্যবহারকারীর নাম লিখুন'
  }
};

let currentLanguage = localStorage.getItem('gameLanguage') || 'en';

function t(key) {
  return translations[currentLanguage]?.[key] || translations.en[key] || key;
}

function setLanguage(lang) {
  currentLanguage = lang;
  localStorage.setItem('gameLanguage', lang);
  updateUI();
}

function updateUI() {
  // Update all text elements with data-i18n attribute
  document.querySelectorAll('[data-i18n]').forEach(el => {
    const key = el.getAttribute('data-i18n');
    el.textContent = t(key);
  });
  
  // Update placeholders
  document.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
    const key = el.getAttribute('data-i18n-placeholder');
    el.placeholder = t(key);
  });
  
  // Update button text
  document.querySelectorAll('[data-i18n-btn]').forEach(el => {
    const key = el.getAttribute('data-i18n-btn');
    el.textContent = t(key);
  });
}

// Initialize on load
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', updateUI);
} else {
  updateUI();
}
