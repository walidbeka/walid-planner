// Firebase Configuration
// استبدل هذه القيم بمشروعك الفعلي من Firebase Console
const firebaseConfig = {
    apiKey: "YOUR_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.appspot.com",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
};

// البريد الإلكتروني المسموح به فقط (حسابك الشخصي)
const ALLOWED_EMAIL = "wmr77077@gmail.com";

// تهيئة Firebase
firebase.initializeApp(firebaseConfig);
const auth = firebase.auth();
const db = firebase.firestore();
const functions = firebase.functions();

// تفعيل التزامن المحلي للقراءة دون اتصال
db.enablePersistence().catch(err => {
    if (err.code === 'failed-precondition') {
        console.warn('لا يمكن تفعيل الاستمرارية - علامات تبويب متعددة مفتوحة');
    } else if (err.code === 'unimplemented') {
        console.warn('المتصفح لا يدعم الاستمرارية');
    }
});