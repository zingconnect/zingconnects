import nodemailer from 'nodemailer';
import dotenv from 'dotenv';
// 🚀 FIXED PATH: Jump up one directory level to 'api', then down into 'config'
import { getPrivateUrl } from '../config/s3.js'; 

dotenv.config();

// Account configuration pools
const emailPool = {
  primary: {
    user: process.env.EMAIL_USER,
    pass: process.env.EMAIL_PASS,
  },
  secondary: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  }
};

// Instantiating reusable transporter structures
const primaryTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: emailPool.primary,
});

const secondaryTransporter = nodemailer.createTransport({
  service: 'gmail',
  auth: emailPool.secondary,
});

/**
 * Intelligent courier wrapper that intercepts quota/network drops 
 * and routes mail through the backup pool.
 */
const sendMailWithFailover = async (mailOptions) => {
  try {
    // 1. Attempt delivery via the primary account
    const primaryOptions = {
      ...mailOptions,
      from: `"ZingConnect" <${emailPool.primary.user}>`
    };
    await primaryTransporter.sendMail(primaryOptions);
    console.log(`[Mailer] Delivered successfully via Primary: ${emailPool.primary.user}`);
  } catch (primaryErr) {
    console.warn(`⚠️ [Primary Limit/Error Encountered]: ${primaryErr.message}. Shifting stream to Fallback...`);
    
    try {
      // 2. Fallback execution layer using secondary support account
      const secondaryOptions = {
        ...mailOptions,
        from: `"ZingConnect" <${emailPool.secondary.user}>`
      };
      await secondaryTransporter.sendMail(secondaryOptions);
      console.log(`✅ [Mailer] Alternate delivery successful via: ${emailPool.secondary.user}`);
    } catch (secondaryErr) {
      // 3. Fallback exhausted
      throw new Error(`All email dispatch pools exhausted. Backup failure: ${secondaryErr.message}`);
    }
  }
};

export const sendOfflineNotification = async (receiver, sender, text, receiverType, fileUrl = null, fileType = null) => {
  // 1. ENTRY DEBUG
  console.log(`[DEBUG Mailer] START - To: ${receiver?.email}, Type: ${receiverType}, Sender: ${sender?._id}`);
  
  try {
    if (!receiver?.email) {
      console.error("[DEBUG Mailer] ABORT: Receiver email is missing.");
      return;
    }

    const baseUrl = "https://www.zingconnect.chat";
    const brandColor = "#007bff"; 
    
    const senderName = sender.firstName ? `${sender.firstName} ${sender.lastName || ''}`.trim() : "Someone";
    const senderLabel = receiverType === 'Agent' ? `User (${senderName})` : `Agent (${senderName})`;
        
    let displayBody = text && text.trim() !== "" ? text : "";
    if (!displayBody) {
      if (fileType === 'image') displayBody = "Sent a photo attachment";
      else if (fileType === 'video') displayBody = "Sent a video attachment";
      else displayBody = "Sent an attachment";
    }

    let embeddedVisual = "";
    let mailAttachments = [];

    // 2. S3 DEBUG: Verify file processing
    if (fileUrl) {
      console.log(`[DEBUG Mailer] Processing attachment: ${fileType} | Key: ${fileUrl}`);
      try {
        const signedViewUrl = await getPrivateUrl(fileUrl);
        console.log(`[DEBUG Mailer] S3 URL signed successfully.`);
        
        if (fileType === 'image') {
           embeddedVisual = `
             <div style="margin-top: 20px; border-radius: 8px; overflow: hidden; border: 1px solid #eee; background-color: #f9f9f9; padding: 10px;">
               <p style="margin: 0 0 10px; color: #666; font-size: 13px; font-weight: bold; text-align: center;">📷 Image Attachment:</p>
               <img src="cid:attached-photo" alt="Attachment" style="width: 100%; max-width: 400px; display: block; margin: auto; border-radius: 4px;">
             </div>
           `;
           mailAttachments.push({
             filename: 'attachment.png',
             path: signedViewUrl, 
             cid: 'attached-photo' 
           });
        } else if (fileType === 'video') {
           embeddedVisual = `
             <div style="margin-top: 20px; padding: 20px; background: #f0f0f0; border-radius: 8px; text-align: center; border: 1px dashed #ccc;">
               <span style="font-size: 40px;">🎥</span>
               <p style="margin: 5px 0 0; color: #666; font-size: 14px; font-weight: bold;">Video Attachment Shared</p>
               <p style="margin: 0; color: #999; font-size: 12px;">Click 'View & Reply' to watch</p>
             </div>
           `;
        }
      } catch (s3Err) {
        console.error(`[DEBUG Mailer] CRITICAL: getPrivateUrl failed: ${s3Err.message}`);
      }
    }

    const path = receiverType === 'Agent' ? `/agent/dashboard?agentId=${sender._id}` : `/user/dashboard?userId=${sender._id}`;
    const callbackUrl = `${baseUrl}${path}`;
    const mediaSubjectNotification = fileType === 'image' ? 'photo' : (fileType === 'video' ? 'video' : 'message');

    const mailOptions = {
      to: receiver.email,
      subject: `New ${mediaSubjectNotification} from ${senderName}`,
      attachments: mailAttachments, 
      html: `
          <div style="font-family: Arial, sans-serif; color: #333; max-width: 600px; margin: auto; border: 1px solid #eee; border-radius: 10px; overflow: hidden;">
            <div style="padding: 20px; text-align: center; background-color: #ffffff; border-bottom: 1px solid #eee;">
              <h1 style="font-size: 24px; color: ${brandColor}; margin: 0;">ZingConnect</h1>
            </div>
            
            <div style="padding: 30px;">
              <p>Hi <strong>${receiver.firstName || 'there'}</strong>,</p>
              <p>You have a new notification from <strong>${senderLabel}</strong>:</p>
              
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

    // 3. DISPATCH DEBUG
    console.log(`[DEBUG Mailer] FINAL: Attempting sendMailWithFailover to: ${receiver.email}`);
    await sendMailWithFailover(mailOptions);
    
    console.log(`[DEBUG Mailer] SUCCESS: Offline routing pipeline completed for: ${receiver.email}`);
  } catch (err) {
    // 4. CATCH DEBUG
    console.error("🔴 [DEBUG Mailer] FAILED Pipeline:", err.stack);
  }
};