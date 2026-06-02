import 'dotenv/config'; // This loads your .env file
import webpush from 'web-push';
import { connectToDatabase } from './config/db.js';
import User from './models/User.js';


// Configure VAPID
webpush.setVapidDetails(
  `mailto:${process.env.VITE_EMAIL}`,
  process.env.VITE_PUBLIC_KEY,
  process.env.VITE_PRIVATE_KEY
);

async function sendTest() {
  await connectToDatabase();
  
  // Replace with the actual email of your test user
  const user = await User.findOne({ email: 'mistycpayne@gmail.com' });
  
  if (!user || !user.pushSubscription) {
    console.log("No user or subscription found!");
    process.exit();
  }

  const payload = JSON.stringify({
    title: "Test Notification",
    body: "If you see this, the push gateway is working!"
  });

  try {
    await webpush.sendNotification(user.pushSubscription, payload);
    console.log("✅ Push sent successfully!");
  } catch (err) {
    console.error("❌ PUSH FAILURE:", err.statusCode, err.message);
  }
}

sendTest();