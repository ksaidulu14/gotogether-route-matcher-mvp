// public/firebase-messaging-sw.js
// Firebase Cloud Messaging Service Worker for GoTogetherRides

importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.12.0/firebase-messaging-compat.js');

const firebaseConfig = self.FIREBASE_CONFIG || {
  apiKey: self.FIREBASE_API_KEY || "AIzaSy_GTR_PLACEHOLDER_API_KEY",
  authDomain: self.FIREBASE_AUTH_DOMAIN || "gotogether-rides.firebaseapp.com",
  projectId: self.FIREBASE_PROJECT_ID || "gotogether-rides",
  storageBucket: self.FIREBASE_STORAGE_BUCKET || "gotogether-rides.appspot.com",
  messagingSenderId: self.FIREBASE_MESSAGING_SENDER_ID || "100000000000",
  appId: self.FIREBASE_APP_ID || "1:100000000000:web:gotogether"
};

try {
  if (!firebase.apps.length) {
    firebase.initializeApp(firebaseConfig);
  }

  const messaging = firebase.messaging();

  messaging.onBackgroundMessage(function(payload) {
    console.log('[firebase-messaging-sw.js] Background message received:', payload);
    const notificationTitle = payload.notification?.title || 'GoTogether Rides';
    const notificationOptions = {
      body: payload.notification?.body || 'New ride update available.',
      icon: '/favicon.ico',
      data: payload.data
    };

    self.registration.showNotification(notificationTitle, notificationOptions);
  });
} catch (err) {
  console.warn('[firebase-messaging-sw.js] Initialization warning:', err.message);
}
