/*
==================================================
GoTogetherRides — Firebase Cloud Messaging (FCM)
Browser Registration & Permission Layer
==================================================
*/

(function () {
  'use strict';

  async function initFCM() {
    // 1. Check Browser Support
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      console.log('FCM permission: Unsupported browser (ServiceWorker/Notification API missing)');
      console.log('FCM registration: Failed (Unsupported browser)');
      console.log('FCM token/installation registration: Failed (Unsupported browser)');
      return;
    }

    // 2. Firebase Configuration Resolution
    const firebaseConfig = window.FIREBASE_CONFIG || {
      apiKey: window.FIREBASE_API_KEY || "AIzaSy_GTR_PLACEHOLDER_API_KEY",
      authDomain: window.FIREBASE_AUTH_DOMAIN || "gotogether-rides.firebaseapp.com",
      projectId: window.FIREBASE_PROJECT_ID || "gotogether-rides",
      storageBucket: window.FIREBASE_STORAGE_BUCKET || "gotogether-rides.appspot.com",
      messagingSenderId: window.FIREBASE_MESSAGING_SENDER_ID || "100000000000",
      appId: window.FIREBASE_APP_ID || "1:100000000000:web:gotogether"
    };

    const vapidKey = window.VAPID_PUBLIC_KEY || window.NEXT_PUBLIC_VAPID_PUBLIC_KEY || undefined;

    // 3. Initialize Firebase SDK safely
    let messaging = null;
    try {
      if (typeof firebase === 'undefined') {
        console.warn('FCM registration: Firebase SDK scripts not loaded yet');
        return;
      }
      if (!firebase.apps.length) {
        firebase.initializeApp(firebaseConfig);
      }
      messaging = firebase.messaging();
    } catch (err) {
      console.warn('FCM registration: Firebase initialization failure:', err.message);
      console.log('FCM token/installation registration: Failed (Initialization error)');
      return;
    }

    // 4. Register Service Worker
    let swRegistration = null;
    try {
      swRegistration = await navigator.serviceWorker.register('/firebase-messaging-sw.js');
      console.log('FCM registration: ServiceWorker registered successfully', swRegistration.scope);
    } catch (swErr) {
      console.warn('FCM registration: ServiceWorker registration failure:', swErr.message);
      console.log('FCM token/installation registration: Failed (ServiceWorker error)');
      return;
    }

    // 5. Check & Request Notification Permission
    let permission = Notification.permission;
    console.log('FCM permission: Current permission status is "' + permission + '"');

    if (permission === 'default') {
      try {
        permission = await Notification.requestPermission();
        console.log('FCM permission: User response for permission prompt is "' + permission + '"');
      } catch (pErr) {
        console.warn('FCM permission: Permission request failure:', pErr.message);
      }
    }

    if (permission !== 'granted') {
      console.log('FCM permission: Permission not granted ("' + permission + '")');
      console.log('FCM token/installation registration: Skipped (Permission not granted)');
      return;
    }

    // 6. Retrieve FCM Token / Installation Registration
    try {
      const tokenOptions = { serviceWorkerRegistration: swRegistration };
      if (vapidKey) {
        tokenOptions.vapidKey = vapidKey;
      }

      const currentToken = await messaging.getToken(tokenOptions);
      if (currentToken) {
        console.log('FCM token/installation registration: Success (Token retrieved)');
        // NOTE: Intentionally NOT storing token in Supabase or sending to server per requirements.
      } else {
        console.log('FCM token/installation registration: No registration token available');
      }
    } catch (tokenErr) {
      console.warn('FCM token/installation registration: Retrieval failure:', tokenErr.message);
    }
  }

  // Initialize FCM after page load to preserve initial loading speed
  if (document.readyState === 'complete') {
    setTimeout(initFCM, 1000);
  } else {
    window.addEventListener('load', function () {
      setTimeout(initFCM, 1000);
    });
  }
})();
