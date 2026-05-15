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
    const logoUrl = `${baseUrl}/icon.png`;
    const brandColor = "#007bff"; 

    // 1. Get a Signed URL for the image so it shows up in the email body
    let embeddedVisual = "";
    if (fileUrl && fileType === 'image') {
       const signedViewUrl = await getPrivateUrl(fileUrl);
       embeddedVisual = `
        <div style="margin-top: 20px; border-radius: 8px; overflow: hidden; border: 1px solid #eee;">
          <img src="${signedViewUrl}" alt="Sent Image" style="width: 100%; max-width: 400px; display: block; margin: auto;">
        </div>
       `;
    } else if (fileUrl && fileType === 'video') {
       embeddedVisual = `
        <div style="margin-top: 20px; padding: 20px; background: #f0f0f0; border-radius: 8px; text-align: center;">
          <span style="font-size: 40px;">🎥</span>
          <p style="margin: 5px 0 0; color: #666; font-size: 14px;">Video Attachment</p>
        </div>
       `;
    }

    const displayBody = text && text.trim() !== "" 
      ? text 
      : (fileType ? `Sent a ${fileType}` : "Sent a message");

    const path = receiverType === 'Agent' 
      ? `/agent/dashboard?userId=${sender._id}` 
      : `/user/dashboard?agentId=${sender._id}`;
    
    const callbackUrl = `${baseUrl}${path}`;

    const subjectPrefix = fileUrl ? `New ${fileType}` : "New message";
    const subject = receiverType === 'Agent' 
        ? `${subjectPrefix} from client ${sender.firstName || 'User'}` 
        : `${subjectPrefix} from ${sender.firstName || 'Zing Agent'}`;

    const mailOptions = {
      from: `"ZingConnect" <${process.env.EMAIL_USER}>`,
      to: receiver.email,
      subject: subject,
      html: `
        <div style="font-family: 'Helvetica Neue', Helvetica, Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #f0f0f0; border-radius: 8px; overflow: hidden;">
          <div style="padding: 20px; text-align: center; border-bottom: 1px solid #f0f0f0; background-color: #ffffff;">
             <h1 style="font-size: 22px; color: ${brandColor}; margin: 0; font-weight: bold;">ZingConnect</h1>
          </div>
          
          <div style="padding: 30px; background-color: #ffffff;">
            <p style="font-size: 16px;">Hi <strong>${receiver.firstName || 'there'}</strong>,</p>
            <p style="font-size: 16px;"><strong>${sender.firstName || 'System'}</strong> sent you a ${fileType || 'message'}:</p>
            
            <div style="background-color: #f8f9fa; border-left: 4px solid ${brandColor}; padding: 15px; margin: 20px 0;">
              <p style="margin: 0; font-style: italic; color: #555;">
                "${displayBody}"
              </p>
            </div>

            ${embeddedVisual}

            <div style="text-align: center; margin-top: 30px;">
              <a href="${callbackUrl}" 
                 style="background-color: ${brandColor}; color: #ffffff; padding: 14px 30px; border-radius: 6px; text-decoration: none; display: inline-block; font-weight: bold;">
                 View & Reply
              </a>
            </div>
          </div>
          
          <div style="background-color: #fcfcfc; padding: 20px; text-align: center; font-size: 12px; color: #999; border-top: 1px solid #f0f0f0;">
            &copy; 2026 ZingConnect.
          </div>
        </div>
      `
    };

    await transporter.sendMail(mailOptions);
  } catch (err) {
    console.error("Mailer Error:", err.message);
  }
};