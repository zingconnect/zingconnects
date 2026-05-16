import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
import { getPrivateUrl } from '../config/s3.js'; // Ensure this is imported to sign the URL

dotenv.config();

export const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
});

/**
 * @param {Object} receiver - Receiver object (User or Agent)
 * @param {Object} sender - Sender object
 * @param {String} text - Message text
 * @param {String} receiverType - 'Agent' or 'User'
 * @param {String} fileUrl - The S3 Key/Url of the file
 * @param {String} fileType - 'image' or 'video'
 */

export const sendOfflineNotification = async (receiver, sender, text, receiverType, fileUrl = null, fileType = null) => {
  try {
    const baseUrl = "https://zingconnect.vercel.app";
    const brandColor = "#007bff"; 
    let displayBody = text && text.trim() !== "" ? text : "";
    
    if (!displayBody) {
      if (fileType === 'image') displayBody = "Sent a photo";
      else if (fileType === 'video') displayBody = "Sent a video";
      else displayBody = "Sent a message";
    }
    let embeddedVisual = "";
    if (fileUrl && fileType === 'image') {
       const signedViewUrl = await getPrivateUrl(fileUrl);
       embeddedVisual = `
        <div style="margin-top: 20px; border-radius: 8px; overflow: hidden; border: 1px solid #eee; background-color: #f9f9f9;">
          <img src="${signedViewUrl}" alt="Attachment" style="width: 100%; max-width: 400px; display: block; margin: auto;">
        </div>
       `;
    } else if (fileUrl && fileType === 'video') {
       embeddedVisual = `
        <div style="margin-top: 20px; padding: 20px; background: #f0f0f0; border-radius: 8px; text-align: center; border: 1px dashed #ccc;">
          <span style="font-size: 40px;">🎥</span>
          <p style="margin: 5px 0 0; color: #666; font-size: 14px; font-weight: bold;">Video Attachment</p>
          <p style="margin: 0; color: #999; font-size: 12px;">Click 'View & Reply' to watch</p>
        </div>
       `;
    }

    const path = receiverType === 'Agent' 
      ? `/agent/dashboard?userId=${sender._id}` 
      : `/user/dashboard?agentId=${sender._id}`;
    
    const callbackUrl = `${baseUrl}${path}`;

    const mailOptions = {
      from: `"ZingConnect" <${process.env.EMAIL_USER}>`,
      to: receiver.email,
      subject: `New ${fileType || 'message'} from ${sender.firstName || 'Zing'}`,
      html: `
        <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
          <div style="padding: 20px; text-align: center; background-color: #ffffff; border-bottom: 1px solid #eee;">
             <h1 style="font-size: 24px; color: ${brandColor}; margin: 0;">ZingConnect</h1>
          </div>
          
          <div style="padding: 30px;">
            <p>Hi <strong>${receiver.firstName || 'there'}</strong>,</p>
            <p>You have a new notification from <strong>${sender.firstName || 'User'}</strong>:</p>
            
            <div style="background-color: #f8f9fa; border-left: 4px solid ${brandColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-style: italic; color: #444; font-size: 16px;">
                "${displayBody}"
              </p>
            </div>

            ${embeddedVisual}

            <div style="text-align: center; margin-top: 30px;">
              <a href="${callbackUrl}" 
                 style="background-color: ${brandColor}; color: #ffffff; padding: 15px 35px; border-radius: 8px; text-decoration: none; display: inline-block; font-weight: bold; font-size: 16px;">
                 View & Reply
              </a>
            </div>
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("Mailer Error:", err.message);
  }
};