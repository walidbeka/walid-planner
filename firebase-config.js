// Firebase Configuration
// استبدل هذه القيم بمشروعك الفعلي من Firebase Console
const firebaseConfig = {
    apiKey: "AIzaSyApivqWcW5MQsYHEBDEdWmFqCV-PTBAujc",
    authDomain: "shoptok-tlanb.firebaseapp.com",
    projectId: "shoptok-tlanb",
    storageBucket: "shoptok-tlanb.firebasestorage.app",
    messagingSenderId: "1021714378106",
    appId: "1:1021714378106:web:fa33af5ff801c9568ebac3"
};

// البريد الإلكتروني المسموح به فقط (حسابك الشخصي)
const ALLOWED_EMAIL = "wmr77077@gmail.com";

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

db.settings({ cacheSizeBytes: firebase.firestore.CACHE_SIZE_UNLIMITED });